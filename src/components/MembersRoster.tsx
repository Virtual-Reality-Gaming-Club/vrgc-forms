"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import AdminDesk from './AdminDesk';

export interface RosterMember {
  id: string;
  name: string;
  registrationNumber: string;
  email: string;
  phone?: string;
  team: string;
  teams: string[];
  position: string;
  avatarUrl?: string;
  isCoordinator?: boolean;
  isCoPresident?: boolean;
  isLead?: boolean;
}

export interface LeadershipPerson {
  id: string;
  name: string;
  role: string;
  category: 'Co-President' | 'Student Coordinator';
  teamOrDept: string;
  regNoOrId?: string;
  email: string;
  avatarUrl: string;
}

/**
 * Splits compound team strings (e.g., "Design and Social Media", "Design & Social", "Tech / PR")
 * into distinct individual domains so a member belongs to both sections without creating a common hybrid section.
 * Preserves Esports Mobile and Esports PC as separate individual categories.
 */
export function extractMemberTeams(rawTeamString: string): string[] {
  if (!rawTeamString) return ['General'];
  const str = rawTeamString.trim();
  if (!str) return ['General'];

  const knownDomains = [
    { key: 'Technical Team', pattern: /\b(tech|technical|developer|web|app|xr|unity|unreal)\b/i },
    { key: 'Design Team', pattern: /\b(design|ui\/ux|graphic|creative)\b/i },
    { key: 'Social Media', pattern: /\b(social|social\s*media|content)\b/i },
    { key: 'PR', pattern: /\b(pr|public\s*relations|outreach|marketing)\b/i },
    { key: 'Esports Mobile', pattern: /\b(esport|esports|gaming)?\s*(mobile|bgmi|codm|freefire)\b/i },
    { key: 'Esports PC', pattern: /\b(esport|esports|gaming)?\s*(pc|computer|valorant|cs2|csgo|dota)\b/i },
    { key: 'Esports', pattern: /\b(esport|esports|gaming|game)\b/i },
    { key: 'Events', pattern: /\b(event|events|management|logistics)\b/i },
    { key: 'Education', pattern: /\b(edu|education|training|research)\b/i },
  ];

  const hasMultiple = /(&|\band\b|,|\/|\+)/i.test(str);
  if (hasMultiple) {
    const matched: string[] = [];
    for (const d of knownDomains) {
      if (d.pattern.test(str)) {
        // If matched Esports Mobile or Esports PC, do not add generic Esports
        if (d.key === 'Esports' && (matched.includes('Esports Mobile') || matched.includes('Esports PC'))) {
          continue;
        }
        if (!matched.includes(d.key)) {
          matched.push(d.key);
        }
      }
    }
    if (matched.length > 0) {
      return matched;
    }

    // Delimiter fallback
    const parts = str
      .split(/&|\band\b|,|\/|\+/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > 0) {
      return Array.from(new Set(parts));
    }
  }

  for (const d of knownDomains) {
    if (d.pattern.test(str)) {
      return [d.key];
    }
  }

  return [str];
}

interface MembersRosterProps {
  onRedirect?: () => void;
}

const MembersRoster: React.FC<MembersRosterProps> = ({ onRedirect }) => {
  const { isPaymentAdmin, user, memberData: authMemberData } = useAuth();
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTeam, setSelectedTeam] = useState<string>('ALL');
  const [selectedPosition, setSelectedPosition] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Reusable member loading function for initial load and CRUD refresh
  const loadAllMembers = useCallback(async () => {
    setLoading(true);
    try {
      const membersMap = new Map<string, RosterMember>();

      // 1. Query `members` collection
      try {
        const membersSnap = await getDocs(collection(db, 'members'));
        membersSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const email = (data.email || data.Email || docSnap.id || '').toLowerCase().trim();
          if (email && email.includes('@')) {
            const pos = (data.position || data.role || 'Member').trim();
            const rawTeam = (data.team || data.domain || 'VRGC Member').trim();
            const posLower = pos.toLowerCase();
            const teamLower = rawTeam.toLowerCase();

            const isCoPres = (posLower.includes('president') || teamLower.includes('president')) && !posLower.includes('vice');
            const isCoord = posLower.includes('student coordinator') || teamLower.includes('student coordinator') || (posLower.includes('coordinator') && !posLower.includes('event'));
            const isLd = posLower.includes('lead') || posLower.includes('head');
            const assignedTeams = extractMemberTeams(rawTeam);

            membersMap.set(email, {
              id: docSnap.id,
              name: data.name || data.Name || data.fullName || 'Member',
              registrationNumber: (data.registrationNumber || data['Registration Number'] || data.regNo || '').toUpperCase(),
              email,
              phone: data.phone || data.Phone || '',
              team: assignedTeams.join(' • '),
              teams: assignedTeams,
              position: pos || 'Member',
              avatarUrl: data.photoUrl || data.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(data.name || email)}`,
              isCoPresident: isCoPres,
              isCoordinator: isCoord,
              isLead: isLd,
            });
          }
        });
      } catch (mErr) {
        console.warn('Error fetching members collection:', mErr);
      }

      // 2. Query `id_cards` collection
      try {
        const idCardsSnap = await getDocs(collection(db, 'id_cards'));
        idCardsSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const email = (data.email || data.Email || docSnap.id || '').toLowerCase().trim();
          if (email && email.includes('@')) {
            const existing = membersMap.get(email);
            const pos = (data.position || existing?.position || 'Member').trim();
            const rawTeam = (data.team || existing?.team || 'General').trim();
            const posLower = pos.toLowerCase();
            const teamLower = rawTeam.toLowerCase();

            const isCoPres = (posLower.includes('president') || teamLower.includes('president')) && !posLower.includes('vice');
            const isCoord = posLower.includes('student coordinator') || teamLower.includes('student coordinator') || (posLower.includes('coordinator') && !posLower.includes('event'));
            const isLd = posLower.includes('lead') || posLower.includes('head');
            const assignedTeams = extractMemberTeams(rawTeam);

            membersMap.set(email, {
              id: existing?.id || docSnap.id,
              name: data.name || data.fullName || existing?.name || 'Member',
              registrationNumber: (data.regNo || data.registrationNumber || existing?.registrationNumber || '').toUpperCase(),
              email,
              phone: data.phone || existing?.phone || '',
              team: assignedTeams.join(' • '),
              teams: assignedTeams,
              position: pos || 'Member',
              avatarUrl: data.photoUrl || data.avatarUrl || existing?.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(data.name || email)}`,
              isCoPresident: isCoPres,
              isCoordinator: isCoord,
              isLead: isLd,
            });
          }
        });
      } catch (idErr) {
        console.warn('Error fetching id_cards collection:', idErr);
      }

      const membersList = Array.from(membersMap.values());
      setMembers(membersList);
    } catch (err) {
      console.error('Failed to load roster:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadAllMembers();
  }, [loadAllMembers]);

  // Compute team counts & metrics (counts members per individual domain)
  const { teamCounts, leadershipPeople, uniqueTeams } = useMemo(() => {
    const counts: Record<string, number> = {};
    const teams = new Set<string>();
    const leadership: LeadershipPerson[] = [];

    // Add Co-Presidents and Student Coordinators ONLY
    members.forEach((m) => {
      m.teams.forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
        teams.add(t);
      });

      if (m.isCoPresident) {
        leadership.push({
          id: m.id || m.email,
          name: m.name,
          role: m.position || 'Co-President',
          category: 'Co-President',
          teamOrDept: m.team || 'Leadership',
          regNoOrId: m.registrationNumber,
          email: m.email,
          avatarUrl: m.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(m.name)}`,
        });
      } else if (m.isCoordinator) {
        leadership.push({
          id: m.id || m.email,
          name: m.name,
          role: m.position || 'Student Coordinator',
          category: 'Student Coordinator',
          teamOrDept: m.team || 'Leadership',
          regNoOrId: m.registrationNumber,
          email: m.email,
          avatarUrl: m.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(m.name)}`,
        });
      }
    });

    return {
      teamCounts: counts,
      leadershipPeople: leadership,
      uniqueTeams: Array.from(teams).sort(),
    };
  }, [members]);

  // Filtered members list based on search and dropdowns
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.registrationNumber.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.teams.some((t) => t.toLowerCase().includes(q)) ||
        m.position.toLowerCase().includes(q);

      const matchesTeam =
        selectedTeam === 'ALL' ||
        m.teams.some((t) => t.toLowerCase() === selectedTeam.toLowerCase());

      let matchesPosition = true;
      if (selectedPosition === 'CO_PRESIDENT') {
        matchesPosition = !!m.isCoPresident;
      } else if (selectedPosition === 'COORDINATOR') {
        matchesPosition = !!m.isCoordinator;
      } else if (selectedPosition === 'LEAD') {
        matchesPosition = !!m.isLead;
      } else if (selectedPosition === 'MEMBER') {
        matchesPosition = !m.isCoPresident && !m.isCoordinator && !m.isLead;
      }

      return matchesSearch && matchesTeam && matchesPosition;
    });
  }, [members, searchQuery, selectedTeam, selectedPosition]);

  return (
    <div className="flex-grow min-h-screen bg-mesh p-4 md:p-8 text-left text-white select-none">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Page Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-purple-500/20">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[13px]">groups</span>
                VRGC CHAPTER ROSTER
              </span>
              <span className="text-[11px] text-slate-400 font-mono">STUDENT LEADERSHIP &amp; CREW DIRECTORY</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">
              Club Members &amp; Team Breakdown
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              Official organizational structure of Virtual Reality &amp; Gaming Club with total strength, team subdivisions, and student governance.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedTeam('ALL');
                setSelectedPosition('ALL');
              }}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">filter_alt_off</span>
              Reset Filters
            </button>
          </div>
        </header>

        {/* Top Summary Cards: Total Strength + Team Counts */}
        <section className="space-y-4">
          <h2 className="text-xs font-bold font-label-caps text-purple-300 tracking-widest uppercase">
            Club Strength &amp; Division Metrics
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {/* Total Members Card (Hero Highlight) */}
            <div className="col-span-2 sm:col-span-3 lg:col-span-2 bg-[#120822] border border-purple-500/40 rounded-2xl p-5 shadow-[0_0_30px_rgba(168,85,247,0.15)] flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-2 right-2 opacity-15">
                <span className="material-symbols-outlined text-7xl text-purple-400">diversity_3</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider block mb-1">
                  TOTAL VRGC STRENGTH
                </span>
                <div className="text-3xl sm:text-4xl font-black text-white">
                  {loading ? '…' : members.length}
                </div>
              </div>
              <p className="text-[11px] text-purple-200/70 mt-3">
                Registered student members across all technical &amp; creative domains
              </p>
            </div>

            {/* Individual Team Cards */}
            {uniqueTeams.map((teamName) => {
              const count = teamCounts[teamName] || 0;
              const isSelected = selectedTeam.toLowerCase() === teamName.toLowerCase();

              return (
                <button
                  key={teamName}
                  onClick={() => setSelectedTeam(isSelected ? 'ALL' : teamName)}
                  className={`p-4 rounded-2xl text-left transition-all border flex flex-col justify-between group cursor-pointer ${
                    isSelected
                      ? 'bg-purple-600/30 border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                      : 'bg-[#12081f]/80 hover:bg-[#180c29] border-white/10 hover:border-purple-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-2">
                    <span className="material-symbols-outlined text-lg text-purple-400 group-hover:scale-110 transition-transform">
                      {teamName.toLowerCase().includes('tech')
                        ? 'terminal'
                        : teamName.toLowerCase().includes('design')
                        ? 'palette'
                        : teamName.toLowerCase().includes('social')
                        ? 'share'
                        : teamName.toLowerCase().includes('pr')
                        ? 'campaign'
                        : teamName.toLowerCase().includes('mobile')
                        ? 'smartphone'
                        : teamName.toLowerCase().includes('pc')
                        ? 'desktop_windows'
                        : teamName.toLowerCase().includes('esport')
                        ? 'sports_esports'
                        : teamName.toLowerCase().includes('edu')
                        ? 'school'
                        : 'group'}
                    </span>
                    <span className="text-xl font-black text-white">{count}</span>
                  </div>
                  <span className="text-xs font-bold text-slate-200 truncate w-full block">
                    {teamName}
                  </span>
                  <span className="text-[10px] text-purple-300/70 mt-1 block">
                    {Math.round((count / (members.length || 1)) * 100)}% of club
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Co-Presidents & Student Coordinators Spotlight Section ONLY */}
        {leadershipPeople.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold font-label-caps text-amber-300 tracking-widest uppercase flex items-center gap-2">
                <span className="material-symbols-outlined text-sm text-amber-400">workspace_premium</span>
                Co-Presidents &amp; Student Coordinators
              </h2>
              <span className="text-xs text-slate-400 font-medium">
                {leadershipPeople.length} {leadershipPeople.length === 1 ? 'Designated Lead' : 'Designated Leads'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {leadershipPeople.map((person) => {
                const isCoPres = person.category === 'Co-President';

                return (
                  <div
                    key={person.id}
                    className={`border rounded-2xl p-4.5 flex items-center gap-4 relative overflow-hidden transition-all duration-200 shadow-md ${
                      isCoPres
                        ? 'bg-[#150a24] border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.12)]'
                        : 'bg-[#120822] border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.1)]'
                    }`}
                  >
                    <img
                      src={person.avatarUrl}
                      alt={person.name}
                      className={`w-13 h-13 rounded-2xl object-cover shrink-0 border ${
                        isCoPres
                          ? 'border-amber-400/50 bg-amber-950/80'
                          : 'border-purple-400/50 bg-purple-950/80'
                      }`}
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="text-sm font-extrabold text-white truncate">{person.name}</h3>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                            isCoPres
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          }`}
                        >
                          {person.category}
                        </span>
                      </div>

                      <p
                        className={`text-xs font-semibold truncate ${
                          isCoPres
                            ? 'text-amber-300'
                            : 'text-purple-300'
                        }`}
                      >
                        {person.role}
                      </p>

                      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono truncate">
                        <span>{person.teamOrDept}</span>
                        {person.regNoOrId && (
                          <>
                            <span>•</span>
                            <span>{person.regNoOrId}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ─── Admin Desk (Payment Admins Only) ─────────────────────────── */}
        {isPaymentAdmin && (
          <AdminDesk
            members={members}
            onMembersChanged={loadAllMembers}
            adminName={user?.displayName || authMemberData?.name || 'Admin'}
            adminEmail={user?.email || ''}
          />
        )}

        {/* Filter and Search Controls */}
        <section className="space-y-4">
          <div className="bg-[#12081f]/90 border border-purple-500/25 rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by candidate name, reg number, email, or role..."
                className="w-full bg-black/40 border border-purple-500/30 rounded-xl pl-10 pr-4 py-2.5 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-400 transition-all"
              />
            </div>

            {/* Team Filter Dropdown */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="flex-1 md:flex-none bg-[#0e0518] border border-purple-500/30 rounded-xl px-3 py-2.5 text-base sm:text-xs text-white focus:outline-none focus:border-purple-400 cursor-pointer min-w-0"
              >
                <option value="ALL">All Teams ({members.length})</option>
                {uniqueTeams.map((t) => (
                  <option key={t} value={t}>
                    {t} ({teamCounts[t] || 0})
                  </option>
                ))}
              </select>

              {/* Role Filter Dropdown */}
              <select
                value={selectedPosition}
                onChange={(e) => setSelectedPosition(e.target.value)}
                className="flex-1 md:flex-none bg-[#0e0518] border border-purple-500/30 rounded-xl px-3 py-2.5 text-base sm:text-xs text-white focus:outline-none focus:border-purple-400 cursor-pointer min-w-0"
              >
                <option value="ALL">All Roles</option>
                <option value="CO_PRESIDENT">Co-Presidents</option>
                <option value="COORDINATOR">Student Coordinators</option>
                <option value="LEAD">Leads &amp; Heads</option>
                <option value="MEMBER">Crew Members</option>
              </select>

              {/* View Toggle */}
              <div className="hidden sm:flex items-center bg-black/40 border border-purple-500/30 rounded-xl p-1 shrink-0">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    viewMode === 'grid' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Grid View"
                >
                  <span className="material-symbols-outlined text-sm">grid_view</span>
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    viewMode === 'table' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Table View"
                >
                  <span className="material-symbols-outlined text-sm">view_list</span>
                </button>
              </div>
            </div>
          </div>

          {/* Filter Status Badge */}
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>
              Showing <strong className="text-white">{filteredMembers.length}</strong> of{' '}
              <strong className="text-purple-300">{members.length}</strong> total crew members
            </span>
            {(selectedTeam !== 'ALL' || selectedPosition !== 'ALL' || searchQuery) && (
              <span className="text-amber-400 text-[11px] flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Filters Active
              </span>
            )}
          </div>
        </section>

        {/* Member Directory: Grid or Table View */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-3 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-xs text-purple-300 font-mono tracking-widest uppercase">
              Loading VRGC Member Directory…
            </span>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="bg-[#12081f]/60 border border-purple-500/20 rounded-3xl p-12 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-slate-500">search_off</span>
            <h3 className="text-lg font-bold text-white">No Members Match Current Filters</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Try clearing your search query or selecting &quot;All Teams&quot; from the filter options above.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedTeam('ALL');
                setSelectedPosition('ALL');
              }}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all mt-2 cursor-pointer"
            >
              Clear All Filters
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredMembers.map((m) => {
              const isLead = m.isCoPresident || m.isCoordinator || m.isLead;

              return (
                <div
                  key={m.id || m.email}
                  className={`group relative bg-[#130822]/90 border rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_0_25px_rgba(168,85,247,0.15)] ${
                    isLead ? 'border-purple-500/40 bg-[#160a29]' : 'border-white/10 hover:border-purple-500/30'
                  }`}
                >
                  <div>
                    {/* Top Avatar & Position Badge */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <img
                        src={m.avatarUrl}
                        alt={m.name}
                        className="w-12 h-12 rounded-xl object-cover border border-purple-400/30 bg-purple-950 shrink-0"
                      />
                      <span
                        className={`px-2.5 py-1 rounded-full text-[9px] font-bold border truncate max-w-[140px] ${
                          m.isCoPresident
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : m.isCoordinator
                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                            : isLead
                            ? 'bg-purple-500/20 text-purple-200 border-purple-500/40'
                            : 'bg-white/5 text-slate-300 border-white/10'
                        }`}
                      >
                        {m.position}
                      </span>
                    </div>

                    {/* Member Details */}
                    <h3 className="text-base font-extrabold text-white group-hover:text-purple-300 transition-colors truncate">
                      {m.name}
                    </h3>
                    <p className="text-xs text-purple-300/80 font-medium truncate mt-0.5">{m.team}</p>

                    <div className="mt-3 space-y-1 text-[11px] text-slate-400 font-mono">
                      {m.registrationNumber && (
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-slate-500">REG:</span>
                          <span className="text-slate-300">{m.registrationNumber}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-slate-500">MAIL:</span>
                        <span className="text-slate-300 truncate">{m.email}</span>
                      </div>
                      {m.phone && (
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-slate-500">TEL:</span>
                          <span className="text-slate-300">{m.phone}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Team Tag Footer */}
                  <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="font-code-sm uppercase">{m.team}</span>
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active Member
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Table View */
          <div className="bg-[#12081f]/90 border border-purple-500/20 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-black/50 text-purple-300 font-bold border-b border-purple-500/20">
                  <tr>
                    <th className="py-3.5 px-4">Member Name</th>
                    <th className="py-3.5 px-4">Registration No.</th>
                    <th className="py-3.5 px-4">Domain / Team</th>
                    <th className="py-3.5 px-4">Role / Position</th>
                    <th className="py-3.5 px-4">Official Email</th>
                    <th className="py-3.5 px-4">Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredMembers.map((m) => (
                    <tr key={m.id || m.email} className="hover:bg-purple-900/10 transition-colors">
                      <td className="py-3 px-4 flex items-center gap-2.5 font-bold text-white">
                        <img
                          src={m.avatarUrl}
                          alt={m.name}
                          className="w-7 h-7 rounded-lg object-cover bg-purple-950 border border-white/10"
                        />
                        <span className="truncate max-w-[180px]">{m.name}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-purple-200">{m.registrationNumber || '—'}</td>
                      <td className="py-3 px-4">{m.team}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                            m.isCoPresident
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : m.isCoordinator
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : m.isLead
                              ? 'bg-purple-500/20 text-purple-200 border border-purple-500/30'
                              : 'bg-white/5 text-slate-300'
                          }`}
                        >
                          {m.position}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">{m.email}</td>
                      <td className="py-3 px-4 font-mono text-slate-400">{m.phone || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MembersRoster;
